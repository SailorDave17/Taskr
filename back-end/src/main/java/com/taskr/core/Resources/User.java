package com.taskr.core.Resources;


import com.fasterxml.jackson.annotation.JsonBackReference;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonManagedReference;

import javax.persistence.*;

import java.util.*;


@Entity
public class User {
    private String name;
    // Reminder to self that the error "OneToMany attribute type should not be(...) was caused
    // by the target not being an @Entity and the Set not being generic enough (was HashSet)
//    @OneToMany(fetch = FetchType.EAGER, mappedBy = "ownedBy", cascade = CascadeType.ALL)
    @JsonManagedReference
    @OneToMany(fetch = FetchType.EAGER, mappedBy = "ownedBy")
    private Collection<Task> taskList = new LinkedHashSet<>();

    @Id
    @GeneratedValue
    private Long id;
    private Integer totalAvailableTime;
    private Integer remainingAvailableTime;
    private Integer committedTime;
    private String userColor;
    private String userIcon;
    private Integer numberTasksAssigned;
    private Integer numberTasksComplete;
    @JsonIgnore
    @ManyToMany
    private Collection<TaskTemplate> tasksUserCannotDo = new LinkedHashSet<>();

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
    }

    public User(String name, Integer totalAvailableTime, String userColor, String userIcon){
        this.name = name;
        this.totalAvailableTime = totalAvailableTime;
        this.userColor = userColor;
        this.userIcon = userIcon;
        taskList = new HashSet<>();
        this.committedTime = 0;
        this.numberTasksAssigned = 0;
        this.numberTasksComplete = 0;
    }

    public void addTask(Task task) {
        taskList.add(task);
        this.numberTasksAssigned +=1;
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

    public Integer getNumberTasksComplete() {
        return numberTasksComplete;
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

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        User user = (User) o;
        return name.equals(user.name) &&
                id.equals(user.id);
    }

    @Override
    public int hashCode() {
        return Objects.hash(name, id);
    }

}
