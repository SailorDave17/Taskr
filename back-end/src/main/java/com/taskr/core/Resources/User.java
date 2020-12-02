package com.taskr.core.Resources;


import com.fasterxml.jackson.annotation.JsonBackReference;
import com.fasterxml.jackson.annotation.JsonManagedReference;

import javax.persistence.*;

import java.util.HashSet;
import java.util.Objects;
import java.util.Set;


@Entity
public class User {
    private String name;
    // Reminder to self that the error "OneToMany attribute type should not be(...) was caused
    // by the target not being an @Entity and the Set not being generic enough (was HashSet)
    @JsonManagedReference
    @OneToMany(mappedBy = "ownedBy")
    private Set<Task> taskList;

    @Id
    @GeneratedValue
    private Long id;
    private Integer totalAvailableTime;
    private Integer remainingAvailableTime;
    private Integer userCommittedTime;
    private String userColor;
    private String userIcon;
    private Integer userNumberTasksAssigned;
    private Integer userNumberTasksComplete;

    protected User() {
    }

    public User(String name) {
        this.name = name;
        Set<Task> taskList = new HashSet<>();
        this.totalAvailableTime = 0;
    }

    public void addTask(Task task) {
        taskList.add(task);
        updateUser();
    }

    public void deleteTask(Task task) {
        this.taskList.remove(task);
        updateUser();
    }

    public Set<Task> getTaskList() {
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

    public Integer getUserNumberTasksAssigned() {
        return userNumberTasksAssigned;
    }
    public void updateUser(){
        updateUserNumberTasksAssigned();
        updateUserNumberTasksCompleted();
        updateUserTimeCommitment();
    }

    public void updateUserNumberTasksAssigned() {
        this.userNumberTasksAssigned = taskList.size();
    }

    public void updateUserNumberTasksCompleted() {
        this.userNumberTasksComplete = userNumberTasksAssigned;
        for (Task task : taskList) {
            if (!task.isDone()) {
                userNumberTasksComplete -= 1;
            }
        }
    }

    public void updateUserTimeCommitment() {
        this.userCommittedTime = 0;
        for (Task task : taskList) {
            this.userCommittedTime += task.getActualWorkTime();
        }
        this.remainingAvailableTime = this.totalAvailableTime - this.userCommittedTime;
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
