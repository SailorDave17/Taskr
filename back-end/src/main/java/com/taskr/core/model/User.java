package com.taskr.core.model;


import com.fasterxml.jackson.annotation.JsonBackReference;
import com.fasterxml.jackson.annotation.JsonManagedReference;
import org.hibernate.annotations.Fetch;
import org.hibernate.annotations.FetchMode;

import javax.persistence.*;
import java.util.Collection;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.Objects;


@Entity
public class User {
    @Id
    @GeneratedValue
    private long id;
    private String name;
    // Reminder to self that the error "OneToMany attribute type should not be(...) was caused
    // by the target not being an @Entity and the Set not being generic enough (was HashSet)
//    @OneToMany(fetch = FetchType.EAGER, mappedBy = "ownedBy", cascade = CascadeType.ALL)
//    @Fetch(value = FetchMode.SELECT)
    @OneToMany(fetch = FetchType.EAGER, mappedBy = "ownedBy")
    private Collection<Task> taskList;
    private Integer totalAvailableTime;
    private Integer remainingAvailableTime;
    private Integer committedTime;
    private String userColor;
    private String userIcon;
    private Integer numberTasksAssigned;
    private Integer numberTasksComplete;
    @JsonBackReference
    @Fetch(value = FetchMode.SELECT)
    @ManyToMany(fetch = FetchType.EAGER, mappedBy = "usersWhoCannotDoThisTask")
    private Collection<TaskTemplate> tasksUserCannotDo;// = new LinkedHashSet<>();

    protected User() {
    }

    public User(String name) {
        this.name = name;
        taskList = new HashSet<>();
        this.totalAvailableTime = 0;
        this.numberTasksComplete = 0;
        this.userColor = "";
        this.userIcon = "";
        //These cannot be set using a constructor without violating encapsulation
        //They are dynamically set when tasks are assigned to a user.
        this.remainingAvailableTime = 0;
        this.committedTime = 0;
        this.numberTasksAssigned = 0;
        this.tasksUserCannotDo = new HashSet<>();
    }

    public User(String name, Integer totalAvailableTime, String userColor, String userIcon) {
        this.name = name;
        this.totalAvailableTime = totalAvailableTime;
        this.userColor = userColor;
        this.userIcon = userIcon;
        taskList = new HashSet<>();
        this.remainingAvailableTime = 0;
        this.committedTime = 0;
        this.numberTasksAssigned = 0;
        this.numberTasksComplete = 0;
        this.tasksUserCannotDo = new HashSet<>();
    }

    public void addTask(Task task) {
        taskList.add(task);
        this.numberTasksAssigned += 1;
        this.committedTime += task.getActualWorkTime();
        this.remainingAvailableTime -= task.getActualWorkTime();
    }

    public void deleteTask(Task task) {
        this.taskList.remove(task);
        this.numberTasksAssigned -= 1;
        this.committedTime -= task.getActualWorkTime();
        this.remainingAvailableTime += task.getActualWorkTime();
    }

    public Collection<Task> getTaskList() {
        return taskList;
    }

    public void setTaskList(Collection<Task> taskList) {
        this.taskList = taskList;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public Long getId() {
        return id;
    }

    public Integer getTotalAvailableTime() {
        return totalAvailableTime;
    }

    public void setTotalAvailableTime(Integer availableTime) {
        this.totalAvailableTime = availableTime;
    }

    public Integer getRemainingAvailableTime() {
        return remainingAvailableTime;
    }

    public void setRemainingAvailableTime(Integer remainingAvailableTime) {
        this.remainingAvailableTime = remainingAvailableTime;
    }

    public Integer getCommittedTime() {
        return committedTime;
    }

    public void setCommittedTime(Integer committedTime) {
        this.committedTime = committedTime;
    }

    public Integer getNumberTasksAssigned() {
        return numberTasksAssigned;
    }

    public void setNumberTasksAssigned(Integer numberTasksAssigned) {
        this.numberTasksAssigned = numberTasksAssigned;
    }

    public Long  getNumberTasksComplete() {
        return taskList.stream().filter(task -> task.isDone()).count();
    }

    public void setNumberTasksComplete(Integer numberTasksComplete) {
        this.numberTasksComplete = numberTasksComplete;
    }

    public String getUserColor() {
        return userColor;
    }

    public void setUserColor(String userColor) {
        this.userColor = userColor;
    }

    public String getUserIcon() {
        return userIcon;
    }

    public void setUserIcon(String userIcon) {
        this.userIcon = userIcon;
    }

    public Collection<TaskTemplate> getTasksUserCannotDo() {
        return tasksUserCannotDo;
    }

    public void setTasksUserCannotDo(Collection<TaskTemplate> tasksUserCannotDo) {
        this.tasksUserCannotDo = tasksUserCannotDo;
    }

    public void addTaskUserCannotDo(TaskTemplate taskTemplate) {
        if (tasksUserCannotDo == null) {
            tasksUserCannotDo = new LinkedHashSet<>();
        }
        this.tasksUserCannotDo.add(taskTemplate);
    }

    public void removeTaskUserCannotDo(TaskTemplate taskTemplate) {
        this.tasksUserCannotDo.remove(taskTemplate);
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        User user = (User) o;
        return id == user.id &&
                name.equals(user.name) &&
                Objects.equals(totalAvailableTime, user.totalAvailableTime) &&
                Objects.equals(remainingAvailableTime, user.remainingAvailableTime) &&
                Objects.equals(committedTime, user.committedTime) &&
                Objects.equals(userColor, user.userColor) &&
                Objects.equals(userIcon, user.userIcon) &&
                Objects.equals(numberTasksAssigned, user.numberTasksAssigned) &&
                Objects.equals(numberTasksComplete, user.numberTasksComplete);
    }

    @Override
    public int hashCode() {
        return Objects.hash(name, id);
    }

    @Override
    public String toString() {
        return "User{" +
                "name='" + name + '\'' +
                ", taskList=" + taskList +
                ", id=" + id +
                ", totalAvailableTime=" + totalAvailableTime +
                ", remainingAvailableTime=" + remainingAvailableTime +
                ", committedTime=" + committedTime +
                ", userColor='" + userColor + '\'' +
                ", userIcon='" + userIcon + '\'' +
                ", numberTasksAssigned=" + numberTasksAssigned +
                ", numberTasksComplete=" + numberTasksComplete +
                ", tasksUserCannotDo=" + tasksUserCannotDo +
                "}\n";
    }
}
